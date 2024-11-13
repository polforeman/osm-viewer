import { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

        try {
            const response = await fetch(url);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
                tileCache.set(tileKey, tiff);
                return tiff;
            } else {
                console.error(`GeoTIFF fetch failed for ${url}: ${response.statusText}`);
                return null;
            }
        } catch (error) {
            console.error(`GeoTIFF fetch error for URL: ${url}`, error);
            return null;
        }
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
            console.error("Coordinates out of bounds for GeoTIFF");
            return null;
        }
    };

    const generateSamplingPoints = (path: [number, number][], interval: number): [number, number][] => {
        const totalLength = turf.length(turf.lineString(path), { units: 'meters' });
        const numPoints = Math.ceil(totalLength / interval); // Determine the number of points
        const actualInterval = totalLength / numPoints; // Recalculate interval to ensure start/end inclusion
        const points: [number, number][] = [];

        for (let dist = 0; dist <= totalLength; dist += actualInterval) {
            const point = turf.along(turf.lineString(path), dist, { units: 'meters' });
            const [lon, lat] = point.geometry.coordinates;
            points.push([lon, lat]); // Keep lon/lat for Turf.js
        }

        // Ensure the end point is included
        const end = path[path.length - 1];
        if (points[points.length - 1][0] !== end[0] || points[points.length - 1][1] !== end[1]) {
            points.push(end);
        }

        return points;
    };

    const calculateSlopes = async (samplingPoints: [number, number][]): Promise<{ slopes: number[]; elevations: number[] }> => {
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

        return { slopes, elevations: elevations.map((e) => e ?? 0) };
    };

    const displayPathsWithSlopes = async (map: L.Map, path: Array<[number, number]>, interval: number) => {
        const samplingPoints = generateSamplingPoints(path, interval);
        const { slopes, elevations } = await calculateSlopes(samplingPoints);
    
        for (let i = 0; i < samplingPoints.length - 1; i++) {
            const startPoint = turf.point(samplingPoints[i]);
            const endPoint = turf.point(samplingPoints[i + 1]);
            const slicedSegment = turf.lineSlice(startPoint, endPoint, turf.lineString(path));
    
            const slicedCoords = slicedSegment.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
            const slope = Math.abs(slopes[i]); // Take absolute value for coloring
            const startElevation = elevations[i];
            const endElevation = elevations[i + 1];
    
            const color = getSlopeColor(slope);
            const polyline = L.polyline(slicedCoords, { color, weight: 3 }).addTo(map);
    
            // Add tooltip with slope and elevation details
            polyline.bindTooltip(
                `Slope: ${slope.toFixed(2)}%, Start: ${startElevation.toFixed(1)}m, End: ${endElevation.toFixed(1)}m`,
                { sticky: true }
            );
        }
    };

    const getSlopeColor = (slope: number): string => {
        const clampedSlope = Math.min(Math.max(slope, 0), 10); // Clamp between 0% and 5%
        const red = Math.floor((clampedSlope / 10) * 255); // Slope of 5% is full red
        const green = Math.floor((1 - clampedSlope / 10) * 255); // Slope of 0% is full green
        return `rgb(${red}, ${green}, 0)`; // Gradient from green (0%) to red (5%)
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
        const data: { elements: { geometry: { lat: number; lon: number }[] }[] } = await response.json();
    
        const segments: Array<Array<[number, number]>> = data.elements.map((element) =>
            element.geometry.map((point) => [point.lon, point.lat])
        );
    
        // Step 1: Display all paths as thin grey lines
        segments.forEach((path) => {
            const flippedPath = path.map(([lon, lat]) => [lat, lon] as [number, number]); // Flip for Leaflet
            L.polyline(flippedPath, { color: 'darkgrey', weight: 1 }).addTo(map);
        });
    
        // Step 2: Display slope-colored paths
        segments.forEach(async (path: Array<[number, number]>) => {
            await displayPathsWithSlopes(map, path, 150); // 150m sampling interval
        });
    };
    

    useEffect(() => {
        const initializedMap = L.map('map').setView([52.543171368317985, 13.402061112637254], 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            opacity: 0.3,
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
