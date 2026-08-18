import { computeScaledDimensions } from '../downscaleImage';

describe('computeScaledDimensions', () => {
  it('scales the longest edge down to maxEdge, preserving aspect ratio', () => {
    // iPhone screenshot dimensions from the reported failing upload
    expect(computeScaledDimensions(1284, 2778, 2048)).toEqual({
      width: 947,
      height: 2048,
    });
  });

  it('scales landscape images by their width', () => {
    expect(computeScaledDimensions(4000, 3000, 2000)).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  it('never upscales an image already within bounds', () => {
    expect(computeScaledDimensions(800, 600, 2048)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('never returns a zero dimension for extreme aspect ratios', () => {
    expect(computeScaledDimensions(10000, 1, 2048)).toEqual({
      width: 2048,
      height: 1,
    });
  });
});
