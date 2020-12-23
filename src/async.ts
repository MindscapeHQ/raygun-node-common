import {
  createHook,
  triggerAsyncId,
  executionAsyncId,
  AsyncResource,
  AsyncResourceOptions,
} from 'async_hooks';

export class AsyncResourceWithFields<T> extends AsyncResource {
  public fields: T;
  constructor(name: string, options: AsyncResourceOptions, fields: T) {
    super(name, options);

    this.fields = fields;
  }
}

export function makeClassCallable(ctor: any) {
  return new Proxy(ctor, {
    apply(target: any, that: any, args: any[]) {
      const instance = new ctor(...args);
      if (that) {
        Object.assign(that, instance);
      }
      return instance;
    },
  });
}

// As of 3.7, TypeScript can't currently handle extending from a base class without
// statically known members, which puts the kibosh on well typed generic class extensions
export function wrapType<Args>(parentClass: any, methods: string[], fieldNames: string[]) {
  class WrappedType<F> extends parentClass {
    _asyncResource: AsyncResourceWithFields<F>;

    constructor(...args: Args[]) {
      super(...args);

      const fields: any = {};

      for (const field of fieldNames) {
        fields[field] = this[field];
      }

      this._asyncResource = new AsyncResourceWithFields(
        parentClass.name,
        { triggerAsyncId: executionAsyncId() },
        fields,
      );
    }
  }

  const callableWrappedType = makeClassCallable(WrappedType);

  for (const method of methods) {
    const oldMethod = callableWrappedType.prototype[method];

    callableWrappedType.prototype[method] = function asyncScopeWrapper<
      F,
      This extends WrappedType<F>,
      Args
    >(this: This, ...args: Args[]) {
      return this._asyncResource.runInAsyncScope(oldMethod, this, ...args);
    };
  }

  return callableWrappedType;
}

export function wrapFunctionWithAsyncResource<This, Args, RT>(
  f: (this: This, ...args: Args[]) => RT,
  t: This,
  asyncResource: AsyncResource,
) {
  return (...args: Args[]): RT => asyncResource.runInAsyncScope(f, t, ...args);
}

export function wrapPromiseInAsyncResource<T>(
  p: Promise<T>,
  asyncResource: AsyncResource,
): Promise<T> {
  const oldThen = p.then;
  const oldCatch = p.catch;

  p.then = function then<This, R>(
    this: This,
    ...args: [
      onfulfilled?: ((value: T) => unknown) | null | undefined,
      onrejected?: ((reason: any) => unknown) | null | undefined,
    ]
  ): any {
    const newPromise = (oldThen as any).apply(
      p,
      args.map((f) =>
        typeof f === 'function' ? wrapFunctionWithAsyncResource(f, this, asyncResource) : f,
      ),
    );

    return wrapPromiseInAsyncResource(newPromise, asyncResource);
  };

  p.catch = function _catch<This, RT>(this: This, f: (err: Error) => RT): any {
    const newPromise = (oldCatch as any).apply(p, [
      wrapFunctionWithAsyncResource(f, this, asyncResource),
    ]);

    return wrapPromiseInAsyncResource(newPromise, asyncResource);
  };

  return p;
}

export function wrapFunctionReturningPromiseWithAsyncResource<This, Args, T>(
  f: (this: This, ...args: Args[]) => Promise<T>,
  label: string,
): (this: This, ...args: Args[]) => Promise<T> {
  return function (this: This, ...args: Args[]) {
    const asyncResource = new AsyncResource(label);

    return wrapPromiseInAsyncResource(f.apply(this, args), asyncResource);
  };
}
