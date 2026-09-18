'use strict';
const identity={id:'UUID PRIMARY KEY',createdAt:'TIMESTAMPTZ NOT NULL',updatedAt:'TIMESTAMPTZ NOT NULL'};
const ref=table=>`UUID NOT NULL REFERENCES wahi_v2.${table}(id) ON DELETE RESTRICT`;
const version='INTEGER NOT NULL CHECK (% > 0)';
module.exports={
  inventoryItems:{...identity,ingredientId:ref('ingredients')+' UNIQUE',baseUnit:'TEXT NOT NULL'},
  inventoryLocations:{...identity,name:'TEXT NOT NULL',description:'TEXT NOT NULL',area:'TEXT',sortOrder:'INTEGER NOT NULL',active:'BOOLEAN NOT NULL',version},
  inventoryAssignments:{...identity,ingredientId:ref('ingredients'),locationId:ref('inventory_locations'),countUnit:'TEXT NOT NULL',sortOrder:'INTEGER NOT NULL',active:'BOOLEAN NOT NULL',version},
  countSessions:{...identity,locationId:ref('inventory_locations'),actorId:'TEXT NOT NULL',observedAt:'TIMESTAMPTZ NOT NULL',status:"TEXT NOT NULL CHECK (% IN ('draft','submitted'))",submittedAt:'TIMESTAMPTZ',notes:'TEXT NOT NULL',snapshot:'JSONB NOT NULL',version},
  inventoryObservations:{id:'UUID PRIMARY KEY',sessionId:ref('count_sessions'),ingredientId:ref('ingredients'),quantity:"NUMERIC NOT NULL CHECK (% >= 0 AND %::text NOT IN ('NaN','Infinity','-Infinity'))",unit:'TEXT NOT NULL',observedAt:'TIMESTAMPTZ NOT NULL',recordedAt:'TIMESTAMPTZ NOT NULL',actorId:'TEXT NOT NULL',supersedesId:'UUID UNIQUE REFERENCES wahi_v2.inventory_observations(id) ON DELETE RESTRICT',reason:'TEXT',conversion:'JSONB NOT NULL'}
};
