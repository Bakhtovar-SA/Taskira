import React, { createElement } from "react";
import type { CSSProperties, ReactNode } from "react";
import { dynamicStyle } from "./dynamicStyle";

export const Fragment = React.Fragment;

type Props = Record<string, unknown> & { className?: string; style?: CSSProperties; children?: ReactNode };

function secured(type: React.ElementType, props: Props | null, key?: React.Key): React.ReactElement {
  if (!props?.style) return createElement(type, key === undefined ? props : { ...props, key });
  const { style, className, ...rest } = props;
  const generated = dynamicStyle(style);
  const next = { ...rest, className: [className, generated].filter(Boolean).join(" ") || undefined };
  return createElement(type, key === undefined ? next : { ...next, key });
}

export const jsx = secured;
export const jsxs = secured;
export const jsxDEV = secured;

export namespace JSX {
  export type ElementType = React.JSX.ElementType;
  export type Element = React.JSX.Element;
  export type ElementClass = React.JSX.ElementClass;
  export interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
  export interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
  export type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
  export interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
  export interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
  export interface IntrinsicElements extends React.JSX.IntrinsicElements {}
}
