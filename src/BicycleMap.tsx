import { useEffect, useState } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';

const BicycleMap: React.FC = () => {
    const [map, setMap] = useState<L.Map | null>(null);

    // Utility: Calculate distance between two points in meters
    const haversineDistance = ([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]) => {
        const R = 6371000; // Earth radius in meters
        const toRad = (x: number) => (x * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Join connected segments into long paths
    const joinPaths = (segments: Array<[number, number][]>): Array<[number, number][]> => {
        const endpointMap: Map<string, { segmentIndex: number; isStart: boolean }> = new Map();

        const getPointKey = ([lat, lon]: [number, number]) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

        // Map endpoints to segment indices
        segments.forEach((segment, index) => {
            endpointMap.set(getPointKey(segment[0]), { segmentIndex: index, isStart: true });
            endpointMap.set(getPointKey(segment[segment.length - 1]), { segmentIndex: index, isStart: false });
        });

        const visited = new Set<number>();
        const longPaths: Array<[number, number][]> = [];

        // Traverse segments to create long paths
        segments.forEach((segment, index) => {
            if (visited.has(index)) return;

            const path: Array<[number, number]> = [...segment];
            visited.add(index);

            let currentEnd = segment[segment.length - 1];

            while (true) {
                const key = getPointKey(currentEnd);
                const connection = endpointMap.get(key);

                if (!connection || visited.has(connection.segmentIndex)) break;

                const nextSegment = segments[connection.segmentIndex];
                visited.add(connection.segmentIndex);

                // Add the next segment, reversing if necessary
                if (connection.isStart) {
                    path.push(...nextSegment.slice(1)); // Avoid duplicating the endpoint
                } else {
                    path.push(...nextSegment.slice(0, -1).reverse());
                }

                currentEnd = path[path.length - 1];
            }

            longPaths.push(path);
        });

        return longPaths;
    };

    // Detect intersections (not used for now)
    /*
    const detectIntersections = (segments: Array<[number, number][]>): Array<boolean> => {
        const endpoints: Array<[number, number]> = segments.flatMap((segment) => [
            segment[0],
            segment[segment.length - 1],
        ]);

        return endpoints.map((endpoint) => {
            const nearbyPoints = endpoints.filter(
                (point) => haversineDistance(endpoint, point) <= 0.5
            );
            return nearbyPoints.length > 2; // True if part of an intersection
        });
    };
    */

    // Display paths on the map
    const displayPaths = (map: L.Map, paths: Array<[number, number][]>) => {
        paths.forEach((path) => {
            const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
            L.polyline(path, { color: randomColor, weight: 3 }).addTo(map);
        });
    };

    // Fetch and process bike paths
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
            element.geometry.map((point: { lat: number; lon: number }) => [point.lat, point.lon])
        );

        const longPaths = joinPaths(segments);

        // Visualize long paths
        displayPaths(map, longPaths);
    };

    // Initialize map
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

    // Add event listener for fetching bike paths
    useEffect(() => {
        if (!map) return;

        map.on('moveend', fetchBicyclePaths);

        return () => {
            map.off('moveend', fetchBicyclePaths);
        };
    }, [map]);

    return <div id="map" style={{ height: '100vh', width: '100%' }} />;
};

export default BicycleMap;
