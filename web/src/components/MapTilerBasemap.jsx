import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { Language, MapStyle, MaptilerLayer } from '@maptiler/leaflet-maptilersdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import { MAPTILER_KEY } from '../map-tiles';

export default function MapTilerBasemap() {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!MAPTILER_KEY) return undefined;

    const layer = new MaptilerLayer({
      apiKey: MAPTILER_KEY,
      language: Language.RUSSIAN,
      style: MapStyle.STREETS,
    });
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  return null;
}
