<script lang="ts">
  import type { AppController } from '../lib/types';
  import Icon from './Icon.svelte';

  let { controller }: { controller: AppController } = $props();
</script>

<section class="hero wrap">
  <div class="hero-copy">
    <div class="eyebrow"><span class="tiny-star">✳</span> A LITTLE THANKS. A BIG MAC.</div>
    <h1>好代码。<br />值得<span>加餐。</span></h1>
    <p>把一句「谢谢你的开源」，<br />变成开发者下一顿好好吃的饭。</p>
    <div class="hero-actions">
      <a
        class="button primary"
        href="#create"
        data-action="start-create"
        onclick={(event) => {
          event.preventDefault();
          controller.scrollTo('create');
        }}
      >
        创建我的赞助页 <Icon name="arrow" />
      </a>
      <a class="text-button" href="#/preview">先看看菜单 <Icon name="arrow" /></a>
    </div>
    <div class="hero-foot">
      <span><Icon name="github" /> 为开源社区而做</span>
      <span>POWERED BY 麦当劳 MCP</span>
    </div>
  </div>
  <div class="hero-art">
    <div class="art-top"><span>THE OPEN SOURCE SPECIAL</span><span>NO. 001</span></div>
    <img
      class="meal-illustration"
      src="/assets/hero-burger.svg"
      alt="汉堡、薯条和饮料组成的一份感谢餐"
    />
    <div class="art-bottom">
      <strong>MERGE<br />& MEAL.</strong>
      <span>下一次灵感<br />从好好吃饭开始 ↗</span>
    </div>
  </div>
</section>
