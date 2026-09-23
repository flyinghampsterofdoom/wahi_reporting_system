'use strict';
// Public persistence mapping; migrations are checked-in SQL, not generated at startup.
const identity={id:'UUID PRIMARY KEY',createdAt:'TIMESTAMPTZ NOT NULL',updatedAt:'TIMESTAMPTZ NOT NULL'};
const revision={id:'UUID PRIMARY KEY',effectiveAt:'TIMESTAMPTZ',recordedAt:'TIMESTAMPTZ NOT NULL',actorId:'TEXT NOT NULL',provenance:'JSONB NOT NULL',note:'TEXT',supersedesId:'UUID UNIQUE',active:'BOOLEAN NOT NULL'};
const ref=(table,required=true)=>`UUID ${required?'NOT NULL ':''}REFERENCES wahi_v2.${table}(id) ON DELETE RESTRICT`;
const quantity='NUMERIC CHECK (% > 0)', money='NUMERIC CHECK (% >= 0)';
const definitions={
  wasteEvents:{id:'UUID PRIMARY KEY',requestId:'UUID NOT NULL',actorId:'TEXT NOT NULL',recordedAt:'TIMESTAMPTZ NOT NULL',scope:'TEXT NOT NULL',locationId:'TEXT',department:'TEXT NOT NULL',ingredientId:ref('ingredients'),recipeId:ref('recipes',false),kind:'TEXT NOT NULL',quantity:'TEXT NOT NULL',unit:'TEXT NOT NULL',reason:'TEXT NOT NULL',note:'TEXT NOT NULL',baseUnit:'TEXT NOT NULL',baseQuantity:'NUMERIC',snapshot:'JSONB NOT NULL'},
  wasteCommonSets:{id:'UUID PRIMARY KEY',scope:'TEXT NOT NULL',week:'TIMESTAMPTZ NOT NULL',snapshot:'JSONB NOT NULL',recordedAt:'TIMESTAMPTZ NOT NULL'},
  importRecords:{id:'UUID PRIMARY KEY',sourceFile:'TEXT NOT NULL',sourceHash:'TEXT NOT NULL',sheet:'TEXT NOT NULL',sourceRow:'INTEGER NOT NULL',logicalType:'TEXT NOT NULL',sourceValues:'JSONB NOT NULL',classification:'TEXT NOT NULL',issues:'JSONB NOT NULL',entityIds:'JSONB NOT NULL',importedAt:'TIMESTAMPTZ NOT NULL'},
  recipeCategories:{...identity,name:'TEXT NOT NULL',sortOrder:'INTEGER NOT NULL',active:'BOOLEAN NOT NULL'},
  recipeCategoryAssignments:{...revision,recipeId:ref('recipes'),categoryId:ref('recipe_categories',false)},
  ...require('./inventory-schema'),
  ingredients:{...identity,name:'TEXT NOT NULL',description:'TEXT NOT NULL',category:'TEXT NOT NULL',tags:'JSONB NOT NULL',active:'BOOLEAN NOT NULL'},
  suppliers:{...identity,name:'TEXT NOT NULL',contact:'TEXT NOT NULL',active:'BOOLEAN NOT NULL'},
  purchaseOptions:{...identity,ingredientId:ref('ingredients'),supplierId:ref('suppliers',false),sku:'TEXT NOT NULL',label:'TEXT NOT NULL',contentQuantity:quantity+' NOT NULL',contentUnit:'TEXT NOT NULL',active:'BOOLEAN NOT NULL'},
  recipes:{...identity,name:'TEXT NOT NULL',outputIngredientId:ref('ingredients')+' UNIQUE',active:'BOOLEAN NOT NULL'},
  menuItems:{...identity,name:'TEXT NOT NULL',active:'BOOLEAN NOT NULL'},
  bases:{...revision,ingredientId:ref('ingredients'),kind:"TEXT NOT NULL CHECK (% IN ('purchase','source','recipe','labor_only'))",purchaseOptionId:ref('purchase_options',false),recipeId:ref('recipes',false)},
  yields:{...revision,ingredientId:ref('ingredients'),sourceIngredientId:ref('ingredients'),sourceQuantity:quantity,sourceUnit:'TEXT',outputQuantity:quantity,outputUnit:'TEXT'},
  measurements:{...revision,ingredientId:ref('ingredients'),measurementKey:'UUID NOT NULL',fromQuantity:quantity+' NOT NULL',fromUnit:'TEXT NOT NULL',toQuantity:quantity+' NOT NULL',toUnit:'TEXT NOT NULL'},
  recipeRevisions:{...revision,recipeId:ref('recipes'),outputQuantity:quantity,outputUnit:'TEXT'},
  prices:{...revision,purchaseOptionId:ref('purchase_options'),amount:money+' NOT NULL',currency:'TEXT NOT NULL CHECK (% ~ \'^[A-Z]{3}$\')'},
  labor:{...revision,ingredientId:ref('ingredients'),componentKey:'UUID NOT NULL',kind:"TEXT NOT NULL CHECK (% IN ('fixed','time'))",outputQuantity:quantity,outputUnit:'TEXT',amount:money,currency:'TEXT',minutes:money,department:"TEXT CHECK (% IN ('FOH','BOH'))"},
  laborRates:{...revision,department:"TEXT NOT NULL CHECK (% IN ('FOH','BOH'))",amount:money+' NOT NULL',currency:'TEXT NOT NULL'},
  sellingPrices:{...revision,menuItemId:ref('menu_items'),amount:money+' NOT NULL',currency:'TEXT NOT NULL'},
  menuMappings:{...revision,menuItemId:ref('menu_items'),recipeId:ref('recipes'),quantity:quantity+' NOT NULL',unit:'TEXT NOT NULL'},
  audit:{id:'UUID PRIMARY KEY',actorId:'TEXT NOT NULL',entityType:'TEXT NOT NULL',entityId:'UUID NOT NULL',action:'TEXT NOT NULL',previous:'JSONB',next:'JSONB NOT NULL',recordedAt:'TIMESTAMPTZ NOT NULL',effectiveAt:'TIMESTAMPTZ',provenance:'JSONB NOT NULL',note:'TEXT',changeId:'UUID NOT NULL'}
};
const snake=s=>s.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
module.exports={definitions,snake};
