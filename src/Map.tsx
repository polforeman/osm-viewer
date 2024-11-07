import { useEffect, useState } from 'react';
import L from 'leaflet';

const Map: React.FC = () => {
    const [map, setMap] = useState<L.Map | null>(null);
    const [pathLayers, setPathLayers] = useState<L.Polyline[]>([]);
    const [autoLoad, setAutoLoad] = useState(false);

    useEffect(() => {
        // Initialize the map centered on Berlin
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
            // Add or remove the 'moveend' event listener based on autoLoad state
            if (autoLoad) {
                map.on('moveend', fetchBicyclePaths);
            } else {
                map.off('moveend', fetchBicyclePaths);
            }
        }

        // Clean up event listener on unmount
        return () => {
            if (map) map.off('moveend', fetchBicyclePaths);
        };
    }, [map, autoLoad]);

    // Function to fetch and display bicycle paths for the current map view
    const fetchBicyclePaths = async () => {
        if (map) {
            // Get the current bounding box of the map
            const bounds = map.getBounds();
            const southWest = bounds.getSouthWest();
            const northEast = bounds.getNorthEast();

            // Clear existing path layers
            pathLayers.forEach(layer => map.removeLayer(layer));
            setPathLayers([]);

            // Construct Overpass API query based on the map’s current bounding box
            const query = `
                [out:json];
                way["highway"="cycleway"](${southWest.lat},${southWest.lng},${northEast.lat},${northEast.lng});
                out geom;
            `;
            const response = await fetch(`https://overpass-api.de/api/interpreter?data=${query}`);
            const data = await response.json();

            // Add new paths to the map
            const newLayers = data.elements.map((element: any) => {
                const latlngs = element.geometry.map((point: { lat: number; lon: number }) => [point.lat, point.lon]);
                const polyline = L.polyline(latlngs, { color: 'blue', weight: 3 }).addTo(map);
                return polyline;
            });

            setPathLayers(newLayers);
        }
    };

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
