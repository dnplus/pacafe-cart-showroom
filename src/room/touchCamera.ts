type Point = { x: number; y: number };
type Pair = Point & { distance: number };
export class TouchCamera {
  private points = new Map<number, Point>();
  private previous: Pair | null = null;
  private used = false;
  private blockedUntil = 0;
  get active() { return this.used && this.points.size > 0; }
  private pair(): Pair | null {
    if (this.points.size !== 2) return null;
    const [a,b] = [...this.points.values()];
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)};
  }
  down(id: number, point: Point) {
    this.points.set(id,point);
    if (this.points.size >= 2) this.used = true;
    this.previous = this.pair();
    return this.active;
  }
  move(id: number, point: Point) {
    if (!this.points.has(id)) return null;
    this.points.set(id,point);
    const next = this.pair(), previous = this.previous; this.previous = next;
    if (!next || !previous || previous.distance < 1 || next.distance < 1) return null;
    return {x:next.x,y:next.y,dx:next.x-previous.x,dy:next.y-previous.y,factor:next.distance/previous.distance};
  }
  up(id: number, now: number) {
    if (!this.points.delete(id)) return;
    this.previous = this.pair();
    if (this.used) this.blockedUntil = now + 400;
    if (!this.points.size) this.used = false;
  }
  blocksClick(now: number) { return this.active || now < this.blockedUntil; }
  clear(now: number) { if (this.used) this.blockedUntil=now+400; this.points.clear(); this.previous=null; this.used=false; }
}
