declare module 'exifr' {
  const exifr: {
    parse(input: any, options?: any): Promise<any>;
    [key: string]: any;
  };
  export default exifr;
}
