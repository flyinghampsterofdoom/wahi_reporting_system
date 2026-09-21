'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{format}=require('../review/public/quantity');
test('quantity display: integer values trim decimal padding',()=>{for(const [v,w]of [['370.0000','370'],['0.0','0'],['12','12'],['-0.000','0']])assert.equal(format(v),w);});
test('quantity display: only narrow near-integer residue is normalized',()=>{for(const v of ['369.999999999999999999','369.9999999999999999'])assert.equal(format(v),'370');assert.equal(format('12.000000000000000001'),'12');assert.equal(format('-12.000000000000000001'),'-12');});
test('quantity display: meaningful fractions and tiny quantities remain exact',()=>{for(const v of ['3.5','0.3333333333333333','0.000000000000000001','369.99999999999','12.00000000001','-0.000000000000000001'])assert.equal(format(v),v);});
test('quantity display: no binary floating point or currency rounding for large values',()=>{assert.equal(format('9007199254740993.5'),'9007199254740993.5');assert.equal(format('123.456789'),'123.456789');assert.equal(format(null),'—');});
