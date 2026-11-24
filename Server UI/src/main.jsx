import React from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import BidManagerControl from '../BidManagerControl.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BidManagerControl />
  </React.StrictMode>
);
