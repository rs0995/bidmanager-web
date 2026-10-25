import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, Globe } from 'lucide-react-native';
import { GlassBlur } from '../ui/GlassBlur';
import { Sheet } from '../ui/Sheet';
import { useSurface } from '../ui/Controls';
import { getRaw, setRaw } from '../../lib/kv';
import { fonts, useTheme } from '../../theme';

/** Shared by Tenders and Archive, as BM Pro's bm.tendersLastWebsiteId is. */
export const LAST_PORTAL_KEY = 'bw.tendersLastPortal';

/**
 * One portal at a time, remembered between visits (BM Pro's SiteScope). Lists only ever
 * load a single portal's tenders and organisations. A remembered portal that no longer
 * exists falls back to the first one.
 */
export function usePortalScope(portals: string[]) {
  const [portal, setPortalState] = useState<string | null>(() =>
    getRaw(LAST_PORTAL_KEY),
  );
  useEffect(() => {
    if (!portals.length) return;
    if (!portal || !portals.includes(portal)) setPortalState(portals[0]);
  }, [portal, portals]);
  const setPortal = (p: string) => {
    setRaw(LAST_PORTAL_KEY, p);
    setPortalState(p);
  };
  // Until the list arrives (or while a stale choice is being replaced) nothing loads.
  const ready = Boolean(portal && portals.includes(portal));
  return { portal: ready ? portal : null, setPortal, ready };
}

/** Full-width dropdown; opens a sheet listing every portal. */
export function PortalPicker({
  portals,
  value,
  onChange,
}: {
  portals: string[];
  value: string | null;
  onChange: (portal: string) => void;
}) {
  const t = useTheme();
  const surface = useSurface();
  const [open, setOpen] = useState(false);

  if (!portals.length) {
    // Same footprint as the picker, so the screen doesn't jump when portals arrive.
    return (
      <View style={[styles.button, surface]}>
        <Text style={[styles.label, { color: t.colors.muted }]}>
          Loading portals…
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Portal: ${value ?? 'choose'}`}
        onPress={() => setOpen(true)}
        style={[styles.button, surface]}
      >
        <GlassBlur amount={14} />
        <Globe size={17} color={t.colors.accent} />
        <Text numberOfLines={1} style={[styles.label, { color: t.colors.ink }]}>
          {value ?? 'Choose portal'}
        </Text>
        <ChevronDown size={18} color={t.colors.muted} />
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Choose portal"
      >
        <View style={styles.list}>
          {portals.map(p => {
            const on = p === value;
            return (
              <Pressable
                key={p}
                accessibilityRole="radio"
                accessibilityLabel={p}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onChange(p);
                  setOpen(false);
                }}
                style={[
                  styles.option,
                  {
                    borderColor: on ? t.colors.accent : t.colors.hair,
                    backgroundColor: on
                      ? t.colors.accentWash
                      : t.colors.surface,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.optionText,
                    { color: on ? t.colors.accentInk : t.colors.ink },
                  ]}
                >
                  {p}
                </Text>
                {on ? <Check size={17} color={t.colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 12,
  },
  label: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5 },
  list: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
  },
  optionText: { flex: 1, fontFamily: fonts.medium, fontSize: 14 },
});
