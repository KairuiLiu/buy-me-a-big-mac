import type { ShareConfig } from './types';

export const BLESSINGS = [
  '愿麦麦保佑认真贡献的你',
  '偷偷请的哦，我是 {name} 的薯条守护神。',
  '此刻语言略显苍白，唯有麦麦配得上我的感谢',
  '我宣布，这个项目值得一份大薯。谁赞成，谁反对？',
  '你的项目救了我，必须请你吃顿麦麦',
  '项目很好用，谢谢你的付出，请你吃顿麦麦',
];

export function blessingsFor(config: ShareConfig): string[] {
  const name = config.sponsorType === 'person' ? config.name : config.repo.split('/')[0];
  return BLESSINGS.map(blessing => blessing.replace('{name}', () => name));
}
