// Same environments as Server UI (BidManagerControl.jsx ENVS), minus Local, which
// only makes sense on the desktop that runs its own backend.
export type EnvKey = 'prod' | 'staging';

export const ENVIRONMENTS: Record<
  EnvKey,
  { label: string; short: string; base: string }
> = {
  prod: {
    label: 'Production',
    short: 'PROD',
    base: 'https://161.118.170.233.sslip.io',
  },
  staging: {
    label: 'Staging',
    short: 'STG',
    base: 'https://bidmanager-api-stg.a.run.app',
  },
};
