// Phase 2G: implement with react-native-biometrics (Face ID / Touch ID, device-local).
export interface BiometricsAdapter {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}

const notReady = () =>
  Promise.reject(new Error('biometrics is not wired yet (Phase 2G)'));

export const biometrics: BiometricsAdapter = {
  isAvailable: notReady,
  authenticate: notReady,
};
