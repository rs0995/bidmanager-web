/// <reference lib="dom" />
import React from 'react';
import { AppRegistry } from 'react-native';
import App from '../App';
import { DeviceChrome, IPHONE } from './DeviceChrome';
import './fonts.css';

// Desktop windows get a tall-iPhone frame (430 x 932) with simulated safe areas and
// device chrome. Narrow windows (a real phone browser) render the app full-screen.
const framed = window.innerWidth > 440;
const insets = { top: IPHONE.top, bottom: IPHONE.bottom, left: 0, right: 0 };

const Preview = () => (
  <App
    insetsOverride={framed ? insets : undefined}
    overlay={framed ? <DeviceChrome /> : undefined}
  />
);

AppRegistry.registerComponent('App', () => Preview);
AppRegistry.runApplication('App', { rootTag: document.getElementById('root') });

// Scale the frame down when the window is shorter than the phone, so the whole
// device (status row to home indicator) stays visible.
function fit() {
  const root = document.getElementById('root');
  if (!root || !framed) return;
  const scale = Math.min(1, (window.innerHeight - 24) / IPHONE.height);
  root.style.transform = `scale(${scale})`;
}
fit();
window.addEventListener('resize', fit);
