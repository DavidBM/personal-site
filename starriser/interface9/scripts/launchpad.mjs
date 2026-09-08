const container = document.querySelector('#catalog');
const counter = document.querySelector('#page-count');
const search = document.querySelector('#search');
try {
  const response = await fetch('./dist/page-catalog.json');
  if (!response.ok) throw new Error('Run ./start.sh or ./build.sh to generate the page directory.');
  const pages = await response.json();
  const rows = [], groups = [];
  container.replaceChildren();
  for (const name of ['Game', 'Authoring & visual labs', 'Demos', 'Browser checks', 'Other pages']) {
    const section = document.createElement('section'); section.className = 'page-group';
    const heading = document.createElement('h3'); heading.textContent = name;
    const list = document.createElement('ul'); section.append(heading, list); container.append(section);
    for (const page of pages.filter(page => page.group === name)) {
      const row = document.createElement('li'); row.className = 'page';
      const label = document.createElement('div'), link = document.createElement('a');
      link.href = './' + page.path.split('/').map(encodeURIComponent).join('/'); link.textContent = page.title;
      const filename = document.createElement('small'); filename.textContent = page.path;
      const description = document.createElement('p'); description.textContent = page.description;
      label.append(link, filename); row.append(label, description); list.append(row);
      rows.push({ row, text: `${page.title} ${page.description} ${page.path}`.toLowerCase() });
    }
    groups.push({ section, list });
  }
  function filter() {
    const query = search.value.trim().toLowerCase(); let visible = 0;
    for (const item of rows) { item.row.hidden = !item.text.includes(query); if (!item.row.hidden) visible++; }
    for (const { section, list } of groups) section.hidden = !Array.from(list.children).some(row => !row.hidden);
    counter.textContent = `${visible} / ${pages.length} pages`;
  }
  search.addEventListener('input', filter); filter();
} catch (error) { container.textContent = error.message; }
