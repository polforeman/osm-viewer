import { useEffect, useState } from 'react';
import L from 'leaflet';

const Map: React.FC = () => {
    const [map, setMap] = useState<L.Map | null>(null);
    const [markers, setMarkers] = useState<L.CircleMarker[]>([]);

    useEffect(() => {
        const initializedMap = L.map('map').setView([52.52, 13.405], 12); // Berlin
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(initializedMap);

        setMap(initializedMap);

        return () => {
            initializedMap.remove();
        };
    }, []);

    const showBicycleParking = async () => {
        if (map) {
            markers.forEach(marker => map.removeLayer(marker));
            setMarkers([]);

            const query = '[out:json];node["amenity"="bicycle_parking"](52.4,13.3,52.6,13.5);out;';
            const response = await fetch(`https://overpass-api.de/api/interpreter?data=${query}`);
            const data = await response.json();

            const newMarkers = data.elements.map((element: any) => {
                const circleMarker = L.circleMarker([element.lat, element.lon], {
                    radius: 8,
                    color: 'blue',
                    fillColor: 'blue',
                    fillOpacity: 0.6
                }).bindPopup('Bicycle Parking');
                circleMarker.addTo(map);
                return circleMarker;
            });

            setMarkers(newMarkers);
        }
    };

    return (
        <div style={{ textAlign: 'center' }}>
            <button onClick={showBicycleParking} style={{ marginBottom: '10px', padding: '10px' }}>
                Show Bicycle Parking
            </button>
            <div id="map" style={{ height: '80vh', width: '80vw', margin: '0 auto' }} />
        </div>
    );
};

export default Map;
