const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function load() {
  const context = {
    h: (selector, props, children) => ({selector, props, children}),
    _: text => text,
    LogMixin: {},
    Animation: {},
    Page: {projector: {scheduleRender() {}}}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/utils/Form.js'), 'utf8'), context, {filename: 'js/utils/Form.js'});
  return context.Form;
}

function radios(node, out = []) {
  if (Array.isArray(node)) node.forEach(child => radios(child, out));
  else if (node && typeof node === 'object') {
    if (node.selector === 'a.radio') out.push(node);
    radios(node.children, out);
  }
  return out;
}

// maquette writes a string property as an attribute, so a click handler sees
// the link's `for` prop as currentTarget.attributes.for.
function click(form, link) {
  const attributes = link.props.for === undefined ? {} : {for: {value: link.props.for}};
  return form.handleRadioClick({currentTarget: {attributes, value: link.props.value}});
}

test('edit form radios change the value they belong to, on every render', () => {
  const Form = load();
  const form = new Form();
  form.addField('radio', 'language', 'Language', {required: true, values: ['en', 'multi']});
  form.addField('radio', 'category', 'Category', {required: true, values: [[6, 'Media'], [9, 'Services']]});
  form.setData({language: 'en', category: 6});
  for (let render = 0; render < 2; render++) {
    const links = radios(form.fields.map(field => form.renderField(field)));
    assert.deepEqual(Array.from(links, link => link.props.for), ['language', 'language', 'category', 'category']);
    click(form, links.find(link => link.props.value === 'multi'));
    click(form, links.find(link => link.props.value === 9));
    assert.equal(form.data.language, 'multi');
    assert.equal(form.data.category, 9);
    form.setData({language: 'en', category: 6});
  }
});
