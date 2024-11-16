import { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import * as GeoTIFF from 'geotiff';

const BicycleMap: React.FC = () => {
    const [map, setMap] = useState<L.Map | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const [showMaxZoomMessage, setShowMaxZoomMessage] = useState(false);
    const showPaths = true;
    const showSlopes = true;

    const MIN_PATH_LENGTH = 10;
    const MAX_SAMPLING_DISTANCE = 150;
    const MAX_SLOPE = 10;
    const INITIAL_ZOOM_LEVEL = 16;
    const MAX_ZOOM_OUT_LEVEL = 15; 
    const MAX_ZOOM_IN_LEVEL = 18; 

    const fetchAndDisplayPaths = async () => {
        if (!map || !showPaths) return;

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

        segments.forEach((path) => {
            const flippedPath = path.map(([lon, lat]) => [lat, lon] as [number, number]);
            L.polyline(flippedPath, { color: 'darkgrey', weight: 3 }).addTo(map);
        });

        if (showSlopes) {
            setIsCalculating(true);
            try {
                await Promise.all(
                    segments.map(async (path) => {
                        await displayPathsWithSlopes(map, path, MAX_SAMPLING_DISTANCE);
                    })
                );
            } finally {
                setIsCalculating(false);
            }
        }
    };

    const displayPathsWithSlopes = async (map: L.Map, path: Array<[number, number]>, interval: number) => {
        const totalLength = turf.length(turf.lineString(path), { units: 'meters' });
        if (totalLength < MIN_PATH_LENGTH) return;

        const samplingPoints = generateSamplingPoints(path, interval);
        const { slopes, elevations } = await calculateSlopes(samplingPoints);

        for (let i = 0; i < samplingPoints.length - 1; i++) {
            const startPoint = turf.point(samplingPoints[i]);
            const endPoint = turf.point(samplingPoints[i + 1]);
            const slicedSegment = turf.lineSlice(startPoint, endPoint, turf.lineString(path));

            const slicedCoords = slicedSegment.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
            const slope = Math.abs(slopes[i]);
            const startElevation = elevations[i];
            const endElevation = elevations[i + 1];

            const color = getSlopeColor(slope);
            const polyline = L.polyline(slicedCoords, { color, weight: 5 }).addTo(map);

            polyline.bindTooltip(
                `Slope: ${slope.toFixed(0)}%, Start: ${startElevation.toFixed(0)}m, End: ${endElevation.toFixed(0)}m`,
                { sticky: true }
            );
        }
    };

    const getSlopeColor = (slope: number): string => {
        const clampedSlope = Math.min(Math.max(slope, 0), MAX_SLOPE);
        const red = Math.floor((clampedSlope / MAX_SLOPE) * 255);
        const green = Math.floor((1 - clampedSlope / MAX_SLOPE) * 255);
        return `rgb(${red}, ${green}, 0)`;
    };

    const generateSamplingPoints = (path: [number, number][], interval: number): [number, number][] => {
        const totalLength = turf.length(turf.lineString(path), { units: 'meters' });
        const numPoints = Math.ceil(totalLength / interval);
        const actualInterval = totalLength / numPoints;
        const points: [number, number][] = [];

        for (let dist = 0; dist <= totalLength; dist += actualInterval) {
            const point = turf.along(turf.lineString(path), dist, { units: 'meters' });
            const [lon, lat] = point.geometry.coordinates;
            points.push([lon, lat]);
        }

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
                slopes.push(0);
            }
        }

        return { slopes, elevations: elevations.map((e) => e ?? 0) };
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

    const fetchGeoTIFF = async (z: number, x: number, y: number): Promise<GeoTIFF.GeoTIFF | null> => {
        const tileCache = new Map<string, GeoTIFF.GeoTIFF>();
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

    useEffect(() => {
        const initializedMap = L.map('map', {
            maxZoom: MAX_ZOOM_IN_LEVEL,
            minZoom: MAX_ZOOM_OUT_LEVEL,
        }).setView([52.543171368317985, 13.402061112637254], INITIAL_ZOOM_LEVEL);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: MAX_ZOOM_IN_LEVEL,
            opacity: 0.3,
            attribution: '© OpenStreetMap contributors',
        }).addTo(initializedMap);

        initializedMap.on('zoomend', () => {
            if (initializedMap.getZoom() === MAX_ZOOM_OUT_LEVEL) {
                setShowMaxZoomMessage(true);
                setTimeout(() => setShowMaxZoomMessage(false), 2000);
            }
        });

        setMap(initializedMap);

        return () => {
            initializedMap.remove();
        };
    }, []);

    useEffect(() => {
        if (!map) return;

        map.on('moveend', fetchAndDisplayPaths);
        fetchAndDisplayPaths();

        return () => {
            map.off('moveend', fetchAndDisplayPaths);
        };
    }, [map]);

    return (
        <div style={{ position: 'relative', textAlign: 'center' }}>
            <div id="map" style={{ height: '80vh', width: '80vw', margin: '0 auto', display: 'inline-block' }} />
            {showMaxZoomMessage && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: '10%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        color: 'white',
                        padding: '10px 20px',
                        borderRadius: '8px',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
                        zIndex: 1000,
                    }}
                >
                    Maximum zoom-out level reached
                </div>
            )}
            {isCalculating && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        color: 'white',
                        padding: '10px 20px',
                        borderRadius: '8px',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
                        zIndex: 1000,
                    }}
                >
                    Calculating slopes...
                </div>
            )}
        </div>
    );
};

export default BicycleMap;
