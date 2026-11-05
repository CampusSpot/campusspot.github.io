// Map layer. Views talk only to the interface below, never to Leaflet directly, so the map library
// could be swapped without touching the game.
//
// createMapView(container, map) → view
//   view.setMap(map)                      redraw the play area and building labels
//   view.setPoses([{ id, pos, heading, color, label, labelSide }])
//                                         markers with a direction arrow and a view cone (results)
//   view.setLines([{ a, b, color }])      e.g. guess ↔ truth
//   view.editPose({ value, color, label, onChange }) → { set(partial), get(), stop() }
//                                         let the user place a position and aim a heading
//   view.pickPoint(onPick)                the next tap on the map calls onPick(pos) (placing labels)
//   view.stopEditing()
//   view.focus(positions)                 zoom to show these positions (results)
//   view.hints = { place, adjust }        instructions matching the map's gestures
//   view.currentBounds()                  visible area as { sw, ne }
//   view.destroy()
//
// Positions are { lat, lng }; headings are compass bearings (0 = north, clockwise).
import { createLeafletView } from './leaflet.js';

export function createMapView(container, map) {
  if (map.type !== 'latlng') throw new Error(`Unsupported map type "${map.type}"`);
  return createLeafletView(container, map);
}
