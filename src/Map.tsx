import { useEffect, useState } from 'react';
import L from 'leaflet';
import * as GeoTIFF from 'geotiff';

const Map: React.FC = () => {
    const [map, setMap] = useState<L.Map | null>(null);
    const [pathLayers, setPathLayers] = useState<L.Polyline[]>([]);
    const [autoLoad, setAutoLoad] = useState(false);

    // Cache for GeoTIFF tiles
    const tileCache = new Map<string, GeoTIFF.GeoTIFF>();

    useEffect(() => {
        const initializedMap = L.map('map').setView([52.52, 13.405], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(initializedMap);

        setMap(initializedMap);

        return () => {
            initializedMap.remove();
        };
    }, []);

    useEffect(() => {
        if (map) {
            if (autoLoad) {
                map.on('moveend', fetchBicyclePaths);
            } else {
                map.off('moveend', fetchBicyclePaths);
            }
        }

        return () => {
            if (map) map.off('moveend', fetchBicyclePaths);
        };
    }, [map, autoLoad]);

    const fetchBicyclePaths = async () => {
        if (!map) return;

        const bounds = map.getBounds();
        const southWest = bounds.getSouthWest();
        const northEast = bounds.getNorthEast();

        pathLayers.forEach(layer => map.removeLayer(layer));
        setPathLayers([]);

        const query = `
            [out:json];
            way["highway"="cycleway"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
            out geom;
        `;
        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${query}`);
        const data = await response.json();

        const newLayers = [];

        for (const element of data.elements) {
            const latlngs = element.geometry.map((point: any) => [point.lat, point.lon]);

            // Fetch and process elevation for the path
            const slopes = await calculatePathSlopes(latlngs);
            for (let i = 0; i < latlngs.length - 1; i++) {
                const color = getSlopeColor(slopes[i]);
                const segment = L.polyline([latlngs[i], latlngs[i + 1]], { color, weight: 3 }).addTo(map);
                newLayers.push(segment);
            }
        }

        setPathLayers(newLayers);
    };

    const fetchGeoTIFF = async (z: number, x: number, y: number): Promise<GeoTIFF.GeoTIFF | null> => {
        const tileKey = `${z}/${x}/${y}`;
        if (tileCache.has(tileKey)) {
            console.log("Using cached GeoTIFF:", tileKey);
            return tileCache.get(tileKey) || null;
        }

        const url = `https://s3.amazonaws.com/elevation-tiles-prod/geotiff/${z}/${x}/${y}.tif`;
        console.log(`Fetching GeoTIFF: ${url}`);
        const response = await fetch(url);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
            tileCache.set(tileKey, tiff);
            console.log("GeoTIFF fetched and cached:", tileKey);
            return tiff;
        }
        console.error("Failed to fetch GeoTIFF:", tileKey);
        return null;
    };

    const getElevation = async (lat: number, lon: number): Promise<number | null> => {
        const zoom = 12; // Adjust as needed
        const x = lon2tile(lon, zoom);
        const y = lat2tile(lat, zoom);

        const tiff = await fetchGeoTIFF(zoom, x, y);
        if (!tiff) return null;

        const image = await tiff.getImage();
        const rasters = await image.readRasters();
        const bbox = image.getBoundingBox();
        const width = image.getWidth();
        const height = image.getHeight();

        console.log("GeoTIFF bounding box:", bbox);
        console.log("GeoTIFF size:", width, height);

        const pixelX = Math.floor(((lon - bbox[0]) / (bbox[2] - bbox[0])) * width);
        const pixelY = Math.floor(((bbox[3] - lat) / (bbox[3] - bbox[1])) * height);

        console.log(`Pixel coordinates: (${pixelX}, ${pixelY})`);

        if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
            const elevation = rasters[0][pixelY * width + pixelX];
            console.log("Elevation value:", elevation);
            return elevation;
        } else {
            console.error("Coordinates out of bounds for GeoTIFF");
            return null;
        }
    };

    const calculatePathSlopes = async (latlngs: [number, number][]): Promise<number[]> => {
        const elevations = await Promise.all(latlngs.map(([lat, lon]) => getElevation(lat, lon)));

        const slopes = [];
        for (let i = 0; i < elevations.length - 1; i++) {
            const elevation1 = elevations[i];
            const elevation2 = elevations[i + 1];

            if (elevation1 !== null && elevation2 !== null) {
                const horizontalDistance = L.latLng(latlngs[i][0], latlngs[i][1]).distanceTo(
                    L.latLng(latlngs[i + 1][0], latlngs[i + 1][1])
                );
                const slope = ((elevation2 - elevation1) / horizontalDistance) * 100;
                slopes.push(slope);

                // Debugging: Print details to console
                console.log(
                    `Segment ${i + 1}:`,
                    `Start: (${latlngs[i][0]}, ${latlngs[i][1]}) Elevation: ${elevation1}m`,
                    `End: (${latlngs[i + 1][0]}, ${latlngs[i + 1][1]}) Elevation: ${elevation2}m`,
                    `Distance: ${horizontalDistance.toFixed(2)}m`,
                    `Slope: ${slope.toFixed(2)}%`
                );
            } else {
                slopes.push(0);
                console.log(`Segment ${i + 1}: Elevation data missing for one or both points.`);
            }
        }
        return slopes;
    };

    const getSlopeColor = (slope: number): string => {
        if (slope < 5) return 'green';
        if (slope < 10) return 'yellow';
        return 'red';
    };

    const lon2tile = (lon: number, zoom: number) => Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    const lat2tile = (lat: number, zoom: number) =>
        Math.floor(
            (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
        );

    return (
        <div style={{ textAlign: 'center' }}>
            <label style={{ display: 'inline-block', marginBottom: '10px' }}>
                <input
                    type="checkbox"
                    checked={autoLoad}
                    onChange={(e) => setAutoLoad(e.target.checked)}
                />
                Auto-load Bicycle Paths
            </label>
            <div id="map" style={{ height: '80vh', width: '80vw', margin: '0 auto' }} />
        </div>
    );
};

export default Map;
