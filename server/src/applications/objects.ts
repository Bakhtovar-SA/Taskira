/** Object schemas and records have their own write boundary; links remain shared. */
export const objectsApplication = {
  id: "objects",
  projectResources: ["object-types", "objects"],
  modules: ["objects"],
} as const;
