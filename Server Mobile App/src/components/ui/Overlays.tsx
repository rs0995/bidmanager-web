import React, { createContext, useCallback, useContext, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Button } from './Button';
import { Txt } from './Txt';

/* ── Bottom sheet ──────────────────────────────────────────────────── */

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }]}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surface,
              borderColor: t.colors.hair,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View
            style={[styles.sheetHead, { borderBottomColor: t.colors.hair }]}
          >
            <Txt variant="title" style={styles.sheetTitle}>
              {title}
            </Txt>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Confirmation sheet for destructive actions (reset sync, abandon, delete). */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Txt color="ink2">{message}</Txt>
      <View style={styles.confirmRow}>
        <Button label="Cancel" onPress={onClose} style={styles.flex} />
        <Button
          label={confirmLabel}
          variant={danger ? 'danger' : 'primary'}
          onPress={() => {
            onConfirm();
            onClose();
          }}
          style={styles.flex}
        />
      </View>
    </Sheet>
  );
}

/* ── Empty state ───────────────────────────────────────────────────── */

/** Bare icon over one muted line (desktop `Empty`). */
export function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Icon size={22} color={t.colors.ink3} />
      <Txt color="ink2" style={styles.emptyTitle}>
        {title}
      </Txt>
      {message ? (
        <Txt variant="small" color="ink3" style={styles.center}>
          {message}
        </Txt>
      ) : null}
    </View>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────── */

const ToastContext = createContext<(msg: string) => void>(() => {});

/** Ink block with a check, bottom centre (desktop toast), above the tab bar. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg ? (
        <View
          pointerEvents="none"
          style={[styles.toastWrap, { bottom: insets.bottom + 74 }]}
        >
          <View
            style={[
              styles.toast,
              { backgroundColor: t.colors.ink, borderColor: t.colors.ink },
            ]}
          >
            <Check size={14} color={t.colors.onAccent} />
            <Txt style={[styles.toastText, { color: t.colors.onAccent }]}>
              {msg}
            </Txt>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderWidth: 1,
    paddingHorizontal: 16,
    gap: 14,
    maxHeight: '88%',
  },
  sheetHead: { borderBottomWidth: 1, paddingTop: 14, paddingBottom: 10 },
  sheetTitle: { fontSize: 19 },
  confirmRow: { flexDirection: 'row', gap: 10 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 36 },
  emptyTitle: { fontSize: 13, textAlign: 'center' },
  center: { textAlign: 'center', maxWidth: 260 },
  toastWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 50,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
  },
  toastText: { fontSize: 12.5 },
});
