import React from 'react';
import BicycleMap from './BicycleMap';

const App: React.FC = () => {
    return (
        <div className="App">
            <h1>Bicycle Path Slope Viewer</h1>
            <p className="subtitle">
                Explore bicycle paths and their slopes. Use the map to navigate and visualize elevation data along cycling routes.
            </p>
            <BicycleMap />
        </div>
    );
};

export default App;
