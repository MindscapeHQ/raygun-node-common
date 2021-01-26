import {
  createHook,
  triggerAsyncId,
  executionAsyncId,
  AsyncResource,
  AsyncResourceOptions,
} from "async_hooks";

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
export function wrapType<Args>(
  parentClass: any,
  methods: string[],
  fieldNames: string[]
) {
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
        fields
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
