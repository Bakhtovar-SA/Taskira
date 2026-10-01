import React, { createElement } from "react";
import { jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";
import type { CSSProperties, ReactNode } from "react";
import { dynamicStyle } from "./dynamicStyle";

export const Fragment = React.Fragment;

type Props = Record<string, unknown> & { className?: string; style?: CSSProperties; children?: ReactNode };

function secured(type: React.ElementType, props: Props | null, key: React.Key | undefined, staticChildren: boolean): React.ReactElement {
  let next: Props | null = props;
  if (props?.style) {
    const { style, className, ...rest } = props;
    const generated = dynamicStyle(style);
    next = { ...rest, className: [className, generated].filter(Boolean).join(" ") || undefined };
  }
  // Keep the CSP style conversion, then use React's smaller production element factory.
  if (import.meta.env.PROD) return (staticChildren ? reactJsxs : reactJsx)(type, next, key);
  if (key !== undefined) next = { ...next, key };
  // Статичные дети (jsxs: <a><b/><c/></a>) — отдельными аргументами, как у настоящего jsxs: массив в props.children
  // React в dev принимает за список и требует key у каждого элемента — консоль тонула в ложных предупреждениях.
  if (staticChildren && Array.isArray(next?.children)) {
    const { children, ...rest } = next;
    return createElement(type, rest, ...(children as ReactNode[]));
  }
  return createElement(type, next);
}

export const jsx = (type: React.ElementType, props: Props | null, key?: React.Key) => secured(type, props, key, false);
export const jsxs = (type: React.ElementType, props: Props | null, key?: React.Key) => secured(type, props, key, true);
export const jsxDEV = (type: React.ElementType, props: Props | null, key?: React.Key, isStaticChildren?: boolean) =>
  secured(type, props, key, !!isStaticChildren);

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
