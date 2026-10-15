import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, View, type CellRendererProps } from "react-native";
import type { Message } from "@ds-bot/mobile-sdk";
import { readingPosition, restoredOffset, type ReadingPosition, type RowLayout } from "../logic/reading-position";

const positions = new Map<string, ReadingPosition>();

export function useReadingPosition(key: string, hydrated: boolean, messages: Message[]) {
  const list = useRef<FlatList<Message>>(null);
  const saved = useRef(positions.get(key) || { offset: 0, bottom: true });
  const bottom = useRef(saved.current.bottom);
  const rows = useRef(new Map<string, RowLayout>());
  const rowNodes = useRef(new Map<string, View>());
  const measureWebRows = () => {
    if (Platform.OS !== "web") return;
    // ResizeObserver does not report position-only changes when new rows arrive.
    for (const [id, view] of rowNodes.current) {
      const node = view as unknown as HTMLElement;
      if (node.offsetHeight) rows.current.set(id, { y: node.offsetTop, height: node.offsetHeight });
    }
  };
  const viewport = useRef({ width: 0, height: 0 });
  const contentHeight = useRef(0);
  const pending = useRef(true);
  const userScrolling = useRef(false);
  const messageIds = useRef(messages.map(message => message.id));
  messageIds.current = messages.map(message => message.id);
  const frame = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const loaded = useRef(hydrated);
  loaded.current = hydrated;

  const restore = useCallback(() => {
    if (!loaded.current || !viewport.current.height) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      measureWebRows();
      if (bottom.current) { userScrolling.current = false; list.current?.scrollToOffset({ offset: 0, animated: false }); }
      else if (pending.current) list.current?.scrollToOffset({ offset: restoredOffset(saved.current, rows.current), animated: false });
      const target = bottom.current ? messageIds.current.at(-1) : saved.current.anchor?.id;
      if (!target || !messageIds.current.includes(target) || rows.current.has(target)) {
        pending.current = false;
        setReady(true);
      }
    });
  }, []);

  useEffect(() => { if (hydrated) restore(); }, [hydrated, restore]);
  useEffect(() => () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    positions.set(key, saved.current);
    if (positions.size > 40) positions.delete(positions.keys().next().value!);
  }, [key]);

  const Cell = useCallback((props: CellRendererProps<Message>) => (
    <View ref={node => { if (node) rowNodes.current.set(props.item.id, node); else rowNodes.current.delete(props.item.id); }} style={props.style} onLayout={event => {
      props.onLayout?.(event);
      const layout = event.nativeEvent.layout;
      const previous = rows.current.get(props.item.id);
      if (layout.height) rows.current.set(props.item.id, layout);
      if (pending.current && (!previous || previous.y !== layout.y || previous.height !== layout.height)) restore();
    }} {...{ onFocusCapture: props.onFocusCapture }}>
      {props.children}
    </View>
  ), [restore]);

  return { list, bottom, ready, Cell,
    onLayout: (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const layout = event.nativeEvent.layout;
      if (!layout.height || !layout.width || (viewport.current.width === layout.width && viewport.current.height === layout.height)) return;
      if (viewport.current.width !== layout.width) { pending.current = true; userScrolling.current = false; }
      viewport.current = layout;
      restore();
    },
    onScroll: (event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
      if (!ready || pending.current || !userScrolling.current || !event.nativeEvent.layoutMeasurement.height) return;
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      measureWebRows();
      saved.current = readingPosition(contentOffset.y, contentSize.height, layoutMeasurement.height, rows.current, true);
      bottom.current = saved.current.bottom;
    },
    onContentSizeChange: (_width: number, height: number) => { if (!height || contentHeight.current === height) return; contentHeight.current = height; if (!bottom.current) { pending.current = true; userScrolling.current = false; } restore(); },
    onScrollBeginDrag: () => {
      if (!ready) return;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      pending.current = false;
      userScrolling.current = true;
      bottom.current = false;
    },
  };
}
