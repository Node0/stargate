export class DateFormatValueConverter {
  toView(timestamp: number): string {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    return date.toLocaleString();
  }
}