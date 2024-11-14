import React from 'react';
import BicycleMap from './BicycleMap';

const App: React.FC = () => {
    return (
        <div className="App" style={{ padding: '2rem', maxWidth: '960px', margin: '0 auto' }}>
            <h1 style={{ textAlign: 'center' }}>Bicycle Path Slope Viewer</h1>
            <p className="subtitle" style={{ textAlign: 'justify', marginBottom: '1.5rem' }}>
                Explore bicycle paths and their slopes. <br />
                Use the map to navigate and visualize elevation data along cycling routes. <br />
                Mouse over a segment to see detailed slope information.
            </p>
            <p className="subtitle" style={{ textAlign: 'justify', marginBottom: '2rem' }}>
                Data sources:<br />
                - Background map and bike paths: <a href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> <br />
                - Elevation: <a href="https://www.opentopodata.org/" target="_blank" rel="noopener noreferrer">OpenTopography (AWS-hosted SRTM tiles)</a>
            </p>
            <p className="subtitle" style={{ textAlign: 'justify', marginBottom: '2rem' }}>
                Pol Foreman, 2024 <br />
            </p>
            <BicycleMap />
        </div>
    );
};

export default App;
