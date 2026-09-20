/* eslint-disable react-native/no-inline-styles */
import React from 'react';

type Props = {
  style?: unknown;
  blurType?: string;
  blurAmount?: number;
  reducedTransparencyFallbackColor?: string;
  children?: React.ReactNode;
};

// Web stand-in for @react-native-community/blur (CSS backdrop-filter).
export function BlurView({ blurAmount = 10, children }: Props) {
  const filter = `blur(${blurAmount}px) saturate(170%)`;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        // Behind the sibling content: positioned elements otherwise paint over it.
        zIndex: -1,
        pointerEvents: 'none',
        backdropFilter: filter,
        WebkitBackdropFilter: filter,
      }}
    >
      {children}
    </div>
  );
}
