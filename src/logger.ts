export type FormatterFn = (msg) => string;

export class Logger {

  constructor(readonly name: string,
              readonly formatter?: FormatterFn) {
  }

  info(msg: string, ...args: any[]) {
    this.log('info', msg, args);
  }

  warn(msg: string, ...args: any[]) {
    this.log('warn', msg, args);
  }

  error(msg: string, ...args: any[]) {
    this.log('error', msg, args);
  }

  private log(level: string, msg: string, args: any[]) {
    let m = `[${new Date().toISOString()}] [${this.name}] ${level} - `;
    m += this.formatter ? this.formatter(msg) : msg;
    if (args && args.length) {
      console.log(m, ...args);
    } else {
      console.log(m);
    }
  }

}
