import { downloadJson } from './download';

beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:luna');
  URL.revokeObjectURL = jest.fn();
});

test('creates a named JSON file download and cleans up', () => {
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    expect(this.download).toBe('luna.json');
    expect(this.href).toContain('blob:luna');
  });

  downloadJson('luna.json', { a: 1 });

  expect(click).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:luna');
  expect(document.querySelector('a[download]')).toBeNull();
  click.mockRestore();
});
