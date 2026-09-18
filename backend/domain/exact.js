'use strict';

// Exact rational arithmetic: decimal inputs never pass through binary floats.
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
class Exact {
  constructor(n, d = 1n) {
    if (!d) throw new Error('Division by zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d); this.n = n / g; this.d = d / g;
  }
  static of(value) {
    if (value instanceof Exact) return value;
    if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value) || value.length > 100) {
      throw new Error('Expected a decimal string (maximum 100 characters)');
    }
    const [whole, fraction = ''] = value.split('.');
    return new Exact(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
  }
  add(x) { x = Exact.of(x); return new Exact(this.n*x.d+x.n*this.d,this.d*x.d); }
  sub(x) { x = Exact.of(x); return new Exact(this.n*x.d-x.n*this.d,this.d*x.d); }
  mul(x) { x = Exact.of(x); return new Exact(this.n*x.n,this.d*x.d); }
  div(x) { x = Exact.of(x); return new Exact(this.n*x.d,this.d*x.n); }
  eq(x) { x = Exact.of(x); return this.n*x.d === x.n*this.d; }
  positive() { return this.n > 0n; }
  nonnegative() { return this.n >= 0n; }
  abs() { return new Exact(this.n < 0n ? -this.n : this.n, this.d); }
  // Round half away from zero only at the serialization boundary.
  decimal(scale = 12) {
    const factor = 10n ** BigInt(scale), n = this.n < 0n ? -this.n : this.n;
    let q = n*factor/this.d;
    if ((n*factor % this.d)*2n >= this.d) q++;
    const s = q.toString().padStart(scale+1,'0');
    return (this.n < 0n && q ? '-' : '') + (scale ? s.slice(0,-scale)+'.'+s.slice(-scale) : s);
  }
}
module.exports = { Exact };
