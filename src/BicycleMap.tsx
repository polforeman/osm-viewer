import { useEffect, useState } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import * as GeoTIFF from 'geotiff';

const BicycleMap: React.FC = () => {
    const [map, setMap] = useState<L.Map | null>(null);

    // Cache for GeoTIFF tiles
    const tileCache = new Map<string, GeoTIFF.GeoTIFF>();

    const fetchGeoTIFF = async (z: number, x: number, y: number): Promise<GeoTIFF.GeoTIFF | null> => {
        const tileKey = `${z}/${x}/${y}`;
        if (tileCache.has(tileKey)) {
            return tileCache.get(tileKey) || null;
        }

        const url = `https://s3.amazonaws.com/elevation-tiles-prod/geotiff/${z}/${x}/${y}.tif`;
        const response = await fetch(url);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
            tileCache.set(tileKey, tiff);
            return tiff;
        }
        console.error("Failed to fetch GeoTIFF:", tileKey);
        return null;
    };

    const latLonToMercator = (lat: number, lon: number): [number, number] => {
        const radius = 6378137;
        const x = radius * (lon * Math.PI) / 180;
        const y = radius * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
        return [x, y];
    };

    const getElevation = async (lon: number, lat: number): Promise<number | null> => {
        const zoom = 12;
        const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
        const y = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * Math.pow(2, zoom));

        const tiff = await fetchGeoTIFF(zoom, x, y);
        if (!tiff) return null;

        const image = await tiff.getImage();
        const rasters = (await image.readRasters()) as GeoTIFF.TypedArray[];
        const bbox = image.getBoundingBox();
        const width = image.getWidth();
        const height = image.getHeight();

        const [mercatorX, mercatorY] = latLonToMercator(lat, lon);

        const pixelX = Math.floor(((mercatorX - bbox[0]) / (bbox[2] - bbox[0])) * width);
        const pixelY = Math.floor(((bbox[3] - mercatorY) / (bbox[3] - bbox[1])) * height);

        if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
            const elevation = rasters[0][pixelY * width + pixelX];
            return elevation;
        } else {
            return null;
        }
    };

    const generateSamplingPoints = (path: [number, number][], interval: number): [number, number][] => {
        const totalLength = turf.length(turf.lineString(path), { units: 'meters' });
        const points: [number, number][] = [];

        for (let dist = 0; dist <= totalLength; dist += interval) {
            const point = turf.along(turf.lineString(path), dist, { units: 'meters' });
            const [lon, lat] = point.geometry.coordinates;
            points.push([lon, lat]); // Keep lon/lat for Turf.js
        }

        return points;
    };

    const calculateSlopes = async (samplingPoints: [number, number][]): Promise<number[]> => {
        const elevations = await Promise.all(samplingPoints.map(([lon, lat]) => getElevation(lon, lat)));
        const slopes: number[] = [];

        for (let i = 0; i < elevations.length - 1; i++) {
            const elevation1 = elevations[i];
            const elevation2 = elevations[i + 1];

            if (elevation1 !== null && elevation2 !== null) {
                const distance = turf.distance(
                    turf.point(samplingPoints[i]),
                    turf.point(samplingPoints[i + 1]),
                    { units: 'meters' }
                );

                if (distance > 0) {
                    const slope = ((elevation2 - elevation1) / distance) * 100;
                    slopes.push(slope);
                } else {
                    slopes.push(0);
                }
            } else {
                slopes.push(0); // Default slope if elevation data is missing
            }
        }

        return slopes;
    };

    const displayPathsWithSlopes = async (map: L.Map, path: [number, number][], interval: number) => {
        const samplingPoints = generateSamplingPoints(path, interval);

        const slopes = await calculateSlopes(samplingPoints);

        for (let i = 0; i < samplingPoints.length - 1; i++) {
            const segment = [samplingPoints[i], samplingPoints[i + 1]];
            const slope = slopes[i];

            // Flip to [lat, lon] for Leaflet
            const flippedSegment: [number, number][] = segment.map(([lon, lat]) => [lat, lon] as [number, number]);

            const color = getSlopeColor(slope);
            const polyline = L.polyline(flippedSegment, { color, weight: 3 }).addTo(map);

            // Add tooltip with slope
            polyline.bindTooltip(`Slope: ${slope.toFixed(2)}%`, { sticky: true });
        }
    };

    const getSlopeColor = (slope: number): string => {
        const clampedSlope = Math.min(Math.max(slope, -10), 10); // Clamp between -10% and 10%
        const red = clampedSlope > 0 ? Math.floor((clampedSlope / 10) * 255) : 0;
        const green = clampedSlope < 0 ? Math.floor((-clampedSlope / 10) * 255) : 0;
        const blue = 255 - Math.abs(clampedSlope / 10) * 255;
        return `rgb(${red}, ${green}, ${blue})`; // Gradient from green to red
    };

    const fetchBicyclePaths = async () => {
        if (!map) return;

        const bounds = map.getBounds();
        const southWest = bounds.getSouthWest();
        const northEast = bounds.getNorthEast();

        const query = `
            [out:json];
            way["highway"="cycleway"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
            out geom;
        `;
        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${query}`);
        const data = await response.json();

        const segments = data.elements.map((element: any) =>
            element.geometry.map((point: { lat: number; lon: number }) => [point.lon, point.lat]) // Convert to [lon, lat] for Turf.js
        );

        segments.forEach(async (path: Array<[number, number]>) => {
            await displayPathsWithSlopes(map, path, 100); // 100m sampling interval
        });
    };

    useEffect(() => {
        const initializedMap = L.map('map').setView([52.52, 13.405], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors',
        }).addTo(initializedMap);

        setMap(initializedMap);

        return () => {
            initializedMap.remove();
        };
    }, []);

    useEffect(() => {
        if (!map) return;

        map.on('moveend', fetchBicyclePaths);

        return () => {
            map.off('moveend', fetchBicyclePaths);
        };
    }, [map]);

    return <div id="map" style={{ height: '80vh', width: '80vw', margin: '0 auto' }} />;
};

export default BicycleMap;
