import { describe, expect, it } from 'vitest';
import {
  avoidPanelCollision,
  clampPanelGeometry,
  clampPanelPosition,
  detectPanelSnapEdges,
  parsePanelPosition,
  parsePanelSize,
  snapPanelPosition,
} from './taskPanelPosition';

describe('task panel position', () => {
  it('parses only persisted finite coordinates', () => {
    expect(parsePanelPosition('{"x":120,"y":64}')).toEqual({ x: 120, y: 64 });
    expect(parsePanelPosition('{"x":"120","y":64}')).toBeNull();
    expect(parsePanelPosition('{"x":null,"y":64}')).toBeNull();
    expect(parsePanelPosition('not json')).toBeNull();
    expect(parsePanelPosition(null)).toBeNull();
  });

  it('clamps a restored or dragged panel inside the viewport', () => {
    const viewport = { width: 1280, height: 720 };
    const panel = { width: 356, height: 638 };

    expect(clampPanelPosition({ x: -40, y: -12 }, viewport, panel)).toEqual({ x: 8, y: 8 });
    expect(clampPanelPosition({ x: 1200, y: 500 }, viewport, panel)).toEqual({ x: 916, y: 74 });
    expect(clampPanelPosition({ x: 420, y: 40 }, viewport, panel)).toEqual({ x: 420, y: 40 });
  });

  it('keeps the panel reachable when the viewport is smaller than the panel', () => {
    expect(clampPanelPosition(
      { x: 200, y: 100 },
      { width: 280, height: 400 },
      { width: 356, height: 638 },
    )).toEqual({ x: 0, y: 0 });
  });

  it('parses only persisted finite positive panel sizes', () => {
    expect(parsePanelSize('{"width":340,"height":560}')).toEqual({ width: 340, height: 560 });
    expect(parsePanelSize('{"width":0,"height":560}')).toBeNull();
    expect(parsePanelSize('{"width":"340","height":560}')).toBeNull();
    expect(parsePanelSize('{"width":340,"height":null}')).toBeNull();
    expect(parsePanelSize('not json')).toBeNull();
    expect(parsePanelSize(null)).toBeNull();
  });

  it('clamps resize dimensions to constraints and viewport space from the current position', () => {
    expect(clampPanelGeometry(
      { x: 700, y: 300 },
      { width: 900, height: 900 },
      { width: 1280, height: 720 },
    )).toEqual({
      position: { x: 700, y: 300 },
      size: { width: 560, height: 412 },
    });

    expect(clampPanelGeometry(
      { x: 1150, y: 680 },
      { width: 100, height: 100 },
      { width: 1280, height: 720 },
    )).toEqual({
      position: { x: 992, y: 352 },
      size: { width: 280, height: 360 },
    });
  });

  it('fits the panel into a viewport smaller than normal minimums', () => {
    expect(clampPanelGeometry(
      { x: 40, y: 30 },
      { width: 320, height: 520 },
      { width: 240, height: 300 },
    )).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 240, height: 300 },
    });
  });

  it('previews and applies restrained magnetic edge snapping', () => {
    const viewport = { width: 1280, height: 720 };
    const panel = { width: 320, height: 520 };

    expect(detectPanelSnapEdges({ x: 18, y: 96 }, viewport, panel)).toEqual({
      left: true,
      right: false,
      top: false,
      bottom: false,
    });
    expect(snapPanelPosition({ x: 18, y: 188 }, viewport, panel)).toEqual({ x: 8, y: 192 });
    expect(snapPanelPosition({ x: 934, y: 187 }, viewport, panel)).toEqual({ x: 952, y: 192 });
    expect(snapPanelPosition({ x: 420, y: 40 }, viewport, panel)).toEqual({ x: 420, y: 40 });
  });

  it('moves a released panel away from the composer exclusion zone when space exists', () => {
    expect(avoidPanelCollision(
      { x: 696, y: 240 },
      { width: 1024, height: 768 },
      { width: 320, height: 520 },
      { left: 340, top: 690, right: 1000, bottom: 768 },
    )).toEqual({ x: 696, y: 162 });
  });
});
