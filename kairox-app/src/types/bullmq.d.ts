declare module 'bullmq' {
  export class Worker {
    constructor(name: string, processor?: any, opts?: any);
    on(event: string, listener: any): this;
  }
  export interface Job<T = any> {
    id?: string;
    data: T;
  }
  export class Queue {
    constructor(name: string, opts?: any);
    add(name: string, data: any, opts?: any): Promise<Job>;
  }
}
