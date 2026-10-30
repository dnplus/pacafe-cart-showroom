import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type RoomZoneName = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const Zones = createContext<Partial<Record<RoomZoneName, HTMLElement>>>({});

export function RoomZone({ zone, children }: { zone: RoomZoneName; children: ReactNode }) {
  const target = useContext(Zones)[zone];
  return target ? createPortal(children, target) : <>{children}</>;
}

/** A room drawn inside a panel keeps its corner overlays to itself instead of the cafe's corners. */
export function NoRoomZones({ children }: { children: ReactNode }) {
  return <Zones.Provider value={{}}>{children}</Zones.Provider>;
}

export function RoomZones({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Partial<Record<RoomZoneName, HTMLElement>>>({});
  const refs = useMemo(() => Object.fromEntries((['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(zone => [zone,
    (element: HTMLElement | null) => { if (element) setTargets(current => current[zone] === element ? current : { ...current, [zone]: element }); }])) as Record<RoomZoneName, (element: HTMLElement | null) => void>, []);
  return <Zones.Provider value={targets}>
    {children}
    <div className="room-zones">
      <div className="room-zone-row" data-row="top"><div className="room-zone" data-zone="top-left" ref={refs['top-left']} /><div className="room-zone" data-zone="top-right" ref={refs['top-right']} /></div>
      <div className="room-zone-row" data-row="bottom"><div className="room-zone" data-zone="bottom-left" ref={refs['bottom-left']} /><div className="room-zone" data-zone="bottom-right" ref={refs['bottom-right']} /></div>
    </div>
  </Zones.Provider>;
}
