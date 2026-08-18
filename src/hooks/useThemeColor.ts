import { useEffect } from 'react';

/**
 * Paints the browser UI and the overscroll area to match the current view.
 *
 * Mobile browsers tint their status bar and toolbar from `meta[theme-color]`,
 * and fall back to the document background when rubber-band scrolling. Without
 * this a full-bleed screen renders inside white bands top and bottom.
 */
export const useThemeColor = (color: string) => {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }

    const previous = {
      meta: meta.content,
      root: document.documentElement.style.backgroundColor,
      body: document.body.style.backgroundColor,
    };

    meta.content = color;
    document.documentElement.style.backgroundColor = color;
    document.body.style.backgroundColor = color;

    return () => {
      meta.content = previous.meta;
      document.documentElement.style.backgroundColor = previous.root;
      document.body.style.backgroundColor = previous.body;
    };
  }, [color]);
};
