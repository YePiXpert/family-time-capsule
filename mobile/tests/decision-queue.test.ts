import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
 Animated: { Value: class { setValue() {} interpolate() { return 0; } }, View: 'AnimatedView' },
 Modal: 'Modal', Pressable: 'Pressable', View: 'View', Text: 'Text',
 StyleSheet: { create: (s: unknown) => s, absoluteFill: {} },
}));
vi.mock('react-native-gesture-handler', () => ({
 Gesture: { Pan: () => { const pan = { activeOffsetY: () => pan, failOffsetY: () => pan, onUpdate: () => pan, onEnd: () => pan }; return pan; } },
 GestureDetector: 'GestureDetector', GestureHandlerRootView: 'GestureHandlerRootView',
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('../src/design/haptics', () => ({ haptics: { selection() {} } }));
vi.mock('../src/design/use-effects', () => ({ useAccessibleEffects: () => ({ reducedMotion: true }) }));
vi.mock('../src/theme', () => ({ useColorTheme: () => ({ scheme: 'light', colors: {} }) }));
vi.mock('../src/components/GlassSurface', () => ({ GlassSurface: 'GlassSurface' }));
vi.mock('../src/components/typography', () => ({ Text: 'Text' }));
const { GlassSheetProvider, confirmSheet, alertSheet } = await import('../src/components/GlassSheet');
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('queues concurrent sheets and ignores a stale completion from the previous sheet', async () => {
 let tree: ReturnType<typeof create>;
 await act(() => { tree = create(createElement(GlassSheetProvider, null)); });
 let firstResolved = false, secondResolved = false;
 await act(() => {
  void confirmSheet({ title: 'First', confirmLabel: '确认' }).then(value => { firstResolved = value; });
  void alertSheet({ title: 'Second' }).then(() => { secondResolved = true; });
 });
 const firstButton = tree!.root.findAllByType('Pressable' as never).find(n => n.props.accessibilityLabel === '确认')!;
 const finishFirst = firstButton.props.onPress;
 await act(() => { finishFirst(); });
 expect(firstResolved).toBe(true);
 expect(secondResolved).toBe(false);
 await act(() => { finishFirst(); });
 expect(secondResolved).toBe(false);
 await act(() => { tree!.root.findAllByType('Pressable' as never).find(n => n.props.accessibilityLabel === '好')!.props.onPress(); });
 expect(secondResolved).toBe(true);
 await act(() => tree!.unmount());
});

it('settles active and queued requests on unmount and rejects stale hook requests safely', async () => {
 let tree: ReturnType<typeof create>;
 await act(() => { tree = create(createElement(GlassSheetProvider, null)); });
 let confirm!: Promise<boolean>, alert!: Promise<void>;
 await act(() => {
  confirm = confirmSheet({ title: 'First' });
  alert = alertSheet({ title: 'Second' });
 });
 await act(() => tree!.unmount());
 await expect(confirm).resolves.toBe(false);
 await expect(alert).resolves.toBeUndefined();
 await expect(confirmSheet({ title: 'Unmounted' })).resolves.toBe(false);
});
