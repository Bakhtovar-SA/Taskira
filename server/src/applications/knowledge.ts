/** Knowledge owns document editing, versions, review, comments and attachments.
 * Collaboration reads the same availability setting before each protocol message. */
export const knowledgeApplication = {
  id: "knowledge",
  projectResources: ["documents"],
  modules: ["documents"],
} as const;
