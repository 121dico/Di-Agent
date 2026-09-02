// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isTaskCardBodyTarget } from './taskCardActivation';

describe('Task Board card activation', () => {
  it('opens from card content but not nested operational controls', () => {
    const card = document.createElement('article');
    const body = document.createElement('span');
    const button = document.createElement('button');
    const buttonIcon = document.createElement('span');
    button.append(buttonIcon);
    card.append(body, button);

    expect(isTaskCardBodyTarget(body, card)).toBe(true);
    expect(isTaskCardBodyTarget(card, card)).toBe(true);
    expect(isTaskCardBodyTarget(button, card)).toBe(false);
    expect(isTaskCardBodyTarget(buttonIcon, card)).toBe(false);
  });

  it('excludes the semantic whole-card button so its native Enter and Space handling fires once', () => {
    const card = document.createElement('article');
    const openButton = document.createElement('button');
    card.append(openButton);

    expect(isTaskCardBodyTarget(openButton, card)).toBe(false);
  });
});
