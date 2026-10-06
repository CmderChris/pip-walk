import { createContext, useCallback, useContext } from 'react';

// Where the model, textures and environment map are served from. The standalone app
// serves them from the site root; a host site that copies them into a subfolder passes
// that folder (e.g. "/pip-walk/") through <PipWalk assetBase>.
export const AssetContext = createContext('/');

export const joinAssetPath = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

/** Returns a function that turns an asset path (relative to the asset base) into a URL. */
export const useAssetUrl = () => {
  const base = useContext(AssetContext);
  return useCallback((path: string) => joinAssetPath(base, path), [base]);
};
