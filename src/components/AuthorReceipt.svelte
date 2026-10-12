<script lang="ts">
  import type { AppController } from '../lib/types';

  let { controller }: { controller: AppController } = $props();
  const state = $derived(controller.state);
  const storeName = $derived(
    state.config?.storeName ||
      (state.selected !== null ? state.stores[state.selected]?.storeName : '等待选择餐厅'),
  );
  const repository = $derived(state.author.repo || 'your-name / awesome-project');
</script>

<aside class="author-aside">
  <div class="receipt dark-receipt">
    <div class="receipt-top"><span>YOUR PROJECT, ON THE MENU</span><span>№ 001</span></div>
    <h3>下一顿。<br /><em>有人请了。</em></h3>
    <div class="receipt-rule"></div>
    <dl>
      <div><dt>01 / GitHub 项目</dt><dd>{repository}</dd></div>
      <div><dt>02 / 参考餐厅</dt><dd>{storeName}</dd></div>
      <div><dt>03 / 收款方式</dt><dd>爱发电 · 微信 / 支付宝</dd></div>
    </dl>
    <div class="receipt-rule"></div>
    <p class="receipt-note">你写下好代码。<br />社区送来一份好胃口。</p>
    <div class="barcode" aria-hidden="true"></div>
    <span class="receipt-bottom">THANK YOU FOR BUILDING IN THE OPEN.</span>
  </div>
  <p class="aside-note">赞助随时送达，作者自行安排用餐。<br />无需等待取餐，也不会直接向餐厅下单。</p>
</aside>
