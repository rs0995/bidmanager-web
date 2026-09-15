import React from 'react';
import ReactDOM from 'react-dom/client';
import IosThemePreview from './IosThemePreview.jsx';

// Dedicated entry so the preview is a first-class page with no query flag:
//   npm run dev  →  http://localhost:3000/preview-ios.html
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <IosThemePreview />
  </React.StrictMode>,
);
