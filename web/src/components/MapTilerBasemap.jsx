import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { Language, MaptilerLayer } from '@maptiler/leaflet-maptilersdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import { MAPTILER_KEY } from '../map-tiles';

/** Russian labels: name:ru, else name when no separate Belarusian tag (typical for shops). */
function russianTextField() {
  return [
    'case',
    ['has', 'name:ru'],
    ['get', 'name:ru'],
    ['all', ['has', 'name'], ['!', ['has', 'name:be']]],
    ['get', 'name'],
    '',
  ];
}

function applyRussianLabels(map) {
  if (!map?.getStyle?.()?.layers) return;
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol') continue;
    const layout = layer.layout;
    if (!layout || !('text-field' in layout)) continue;
    try {
      map.setLayoutProperty(layer.id, 'text-field', russianTextField());
    } catch {
      /* some layers may not allow edits */
    }
  }
}

export default function MapTilerBasemap() {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!MAPTILER_KEY) return undefined;

    const style = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}&language=ru`;
    const layer = new MaptilerLayer({
      apiKey: MAPTILER_KEY,
      language: Language.RUSSIAN,
      style,
    });

    const onReady = () => {
      layer.setLanguage(Language.RUSSIAN);
      const mtMap = layer.getMaptilerSDKMap?.();
      if (mtMap) {
        mtMap.setLanguage(Language.RUSSIAN);
        applyRussianLabels(mtMap);
        mtMap.once('idle', () => applyRussianLabels(mtMap));
      }
    };

    layer.on('ready', onReady);
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      layer.off('ready', onReady);
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  return null;
}
