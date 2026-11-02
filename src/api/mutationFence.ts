/** A reconciliation started before/during a write must not overwrite its result.
 * Also covers uploads and issue subresources which don't change the issue DTO yet. */
let revision = 0;
let pending = 0;
export const readMutationFence = () => ({ revision, pending });
export function beginMutation() {
  revision++;
  pending++;
  return () => { revision++; pending--; };
}
