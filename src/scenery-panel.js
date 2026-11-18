import { PLANTS, HARDSCAPE, TOYS, MAX_PLANTS, MAX_HARDSCAPE, MAX_TOYS } from './simulation.js';

const { author, ...floatingToys } = TOYS;

export function sceneryPanel(state, expandedKind, escape) {
  function section(title, items, catalog, category, limit, unit = category === 'plant' ? '丛' : '件') {
    const plant = category === 'plant';
    let count = 0;
    const rows = Object.entries(catalog).map(([kind, entry]) => {
      const placed = items.filter(item => (plant ? item.species : item.kind) === kind);
      count += placed.length;
      const expanded = expandedKind === kind;
      const last = placed.at(-1);
      const details = expanded && placed.length ? `<ul class="placed-items">
        ${placed.map(item => {
          const colorName = entry.colors?.[item.color];
          const label = `${entry.name} #${String(item.slot + 1).padStart(2, '0')}${colorName ? ' · ' + colorName : ''}`;
          return `<li><span>${label}</span><button data-remove-${category}="${escape(item.id)}" aria-label="移出${label}">移出</button></li>`;
        }).join('')}</ul>` : '';
      return `<div class="scenery-row">
        <div class="scenery-controls">
          <button class="scenery-kind" data-show-kind="${kind}" aria-expanded="${expanded}" ${placed.length ? '' : 'disabled'}>
            <strong>${entry.name}</strong><span>${placed.length} ${unit} <span aria-hidden="true">${expanded ? '▴' : '▾'}</span></span>
          </button>
          <button class="quantity" data-remove-${category}="${escape(last?.id)}" aria-label="减少一${unit}${entry.name}" title="移出最后加入的${entry.name}" ${last ? '' : 'disabled'}>−</button>
          <button class="quantity" data-add-${category}="${kind}" aria-label="添加一${unit}${entry.name}" ${items.length >= limit ? 'disabled' : ''}>＋</button>
        </div>${details}</div>`;
    }).join('');
    return `<div class="section-label"><span>${title}</span><span>${count} ${unit}</span></div><div class="scenery-list">${rows}</div>`;
  }
  return section('水草', state.plants, PLANTS, 'plant', MAX_PLANTS)
    + section('石与沉木', state.hardscape, HARDSCAPE, 'hardscape', MAX_HARDSCAPE)
    + '<p class="micro-note">点品种名称可按编号移出。水草在光照下吸收硝酸盐并产氧。</p>'
    + section('漂浮玩具', state.toys, floatingToys, 'toy', MAX_TOYS)
    + '<p class="micro-note">小黄鸭和小游泳圈随水面起伏。游泳圈放入时随机选色。潜水员具有中性浮力，随水流上下漂移。</p>'
    + section('恶搞造景', state.toys, { author }, 'toy', MAX_TOYS, '位');
}
