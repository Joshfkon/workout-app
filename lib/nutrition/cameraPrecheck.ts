/**
 * Before asking for the camera on the web: if the browser can list devices
 * and lists no video input, there is no camera to ask for (a desktop without
 * a webcam). Returns 'missing' then, else null ("try it"). Never throws, and
 * an empty or failed listing is NOT taken as proof of no camera, except the
 * explicit "devices listed, none of them video" case.
 *
 * Lives outside BarcodeScanner (which re-exports it) so the Add food sheet
 * can say "no camera, you'll type the number" BEFORE Scan barcode is tapped
 * without loading the scanner chunk.
 */
export async function precheckWebCamera(
  nav: { mediaDevices?: { enumerateDevices?: () => Promise<Array<{ kind: string }>> } } | undefined
): Promise<'missing' | null> {
  const enumerate = nav?.mediaDevices?.enumerateDevices;
  if (typeof enumerate !== 'function') return null;
  try {
    const devices = await enumerate.call(nav!.mediaDevices);
    if (devices.length > 0 && !devices.some((d) => d.kind === 'videoinput')) return 'missing';
    return null;
  } catch {
    return null;
  }
}

/** Said next to Scan barcode, before the tap, when the device has no camera. */
export const NO_CAMERA_UP_FRONT =
  'No camera on this device, so Scan barcode lets you type the number printed under the bars instead.';
