import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
};

/** Phase 1: checks the form only. Phase 2B sends it to the server. */
export function ChangePasswordSheet({ visible, onClose, onSaved }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [tried, setTried] = useState(false);

  const currentError = tried && !current ? 'Enter your current password' : '';
  const nextError = tried && next.length < 8 ? 'Use at least 8 characters' : '';

  const close = () => {
    setCurrent('');
    setNext('');
    setTried(false);
    onClose();
  };
  const save = () => {
    setTried(true);
    if (!current || next.length < 8) return;
    setCurrent('');
    setNext('');
    setTried(false);
    onSaved();
  };

  return (
    <Sheet visible={visible} onClose={close} title="Change password">
      <View style={styles.form}>
        <Field
          label="Current password"
          secureTextEntry
          value={current}
          onChangeText={setCurrent}
          error={currentError}
          autoCapitalize="none"
        />
        <Field
          label="New password"
          secureTextEntry
          value={next}
          onChangeText={setNext}
          error={nextError}
          hint="At least 8 characters"
          autoCapitalize="none"
        />
      </View>
      <Button block label="Save password" onPress={save} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
});
