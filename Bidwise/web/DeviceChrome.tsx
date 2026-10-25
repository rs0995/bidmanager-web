import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../src/theme';

// Browser-preview only: draws the parts of an iPhone the OS normally provides so the
// layout can be judged with a real status row, Dynamic Island and home indicator.

export const IPHONE = { width: 430, height: 932, top: 59, bottom: 34 };

export function DeviceChrome() {
  const t = useTheme();
  const ink = t.colors.ink;
  return (
    <View pointerEvents="none" style={styles.fill}>
      <View style={styles.island} />
      <Text style={[styles.time, { color: ink }]}>9:41</Text>
      <View style={styles.right}>
        <View style={styles.bars}>
          {[5, 7, 9, 12].map(h => (
            <View
              key={h}
              style={[styles.bar, { height: h, backgroundColor: ink }]}
            />
          ))}
        </View>
        <Text style={[styles.net, { color: ink }]}>5G</Text>
        <View style={[styles.batt, { borderColor: ink }]}>
          <View style={[styles.battFill, { backgroundColor: ink }]} />
        </View>
      </View>
      <View style={[styles.home, { backgroundColor: ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  island: {
    position: 'absolute',
    top: 11,
    alignSelf: 'center',
    width: 126,
    height: 37,
    borderRadius: 20,
    backgroundColor: '#050506',
  },
  time: {
    position: 'absolute',
    top: 20,
    left: 52,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  right: {
    position: 'absolute',
    top: 23,
    right: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  bar: { width: 3, borderRadius: 1 },
  net: { fontFamily: fonts.bold, fontSize: 12 },
  batt: {
    width: 26,
    height: 13,
    borderWidth: 1,
    borderRadius: 4,
    padding: 1.5,
    opacity: 0.9,
  },
  battFill: { flex: 1, borderRadius: 2, width: '75%' },
  home: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    width: 140,
    height: 5,
    borderRadius: 3,
    opacity: 0.9,
  },
});
