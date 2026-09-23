'use strict';
const COLLECTIONS = ['ingredients','suppliers','purchaseOptions','recipes','menuItems','bases','yields','measurements','recipeRevisions','prices','labor','laborRates','sellingPrices','menuMappings','inventoryItems','inventoryLocations','inventoryAssignments','countSessions','inventoryObservations','audit','recipeCategories','recipeCategoryAssignments','importRecords','wasteEvents','wasteCommonSets'];
function emptyState() { return Object.fromEntries(COLLECTIONS.map(k => [k,[]])); }
module.exports = { COLLECTIONS, emptyState };
